use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    system_program,
};
use spl_token::state::{Account as TokenAccount, Mint};

use crate::{error::EscrowError, state::Escrow};

pub fn process_exchange(
    accounts: &[AccountInfo],
    sell_amount: u64,
    buy_amount: u64,
    program_id: &Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let authority = next_account_info(account_info_iter)?;
    let taker = next_account_info(account_info_iter)?;
    if !taker.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let taker_sell_mint = next_account_info(account_info_iter)?;
    let taker_buy_mint = next_account_info(account_info_iter)?;

    let taker_sell_mint_ata = next_account_info(account_info_iter)?;
    let taker_buy_mint_ata = next_account_info(account_info_iter)?;

    let send_token_account = next_account_info(account_info_iter)?;
    let send_token_account_info = TokenAccount::unpack(&send_token_account.try_borrow_data()?)?;

    let escrow_account = next_account_info(account_info_iter)?;
    let escrow_token_account = next_account_info(account_info_iter)?;

    let escrow_token_account_info = TokenAccount::unpack(&escrow_token_account.try_borrow_data()?)?;

    let token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if buy_amount != escrow_token_account_info.amount {
        return Err(EscrowError::ExpectedAmountMismatch.into());
    }

    let escrow_info = Escrow::try_from_slice(&escrow_account.try_borrow_data()?)?;

    if escrow_info.buy_amount != sell_amount {
        return Err(EscrowError::ExpectedAmountMismatch.into());
    }

    if escrow_info.receive_account != *send_token_account.key {
        return Err(ProgramError::InvalidAccountData);
    }

    if escrow_info.authority != send_token_account_info.owner {
        return Err(ProgramError::InvalidAccountData);
    }

    let sell_mint_decimal = Mint::unpack(&taker_sell_mint.data.borrow())?.decimals;

    let transfer_from_taker_ix = spl_token::instruction::transfer_checked(
        token_program.key,
        taker_sell_mint_ata.key,
        taker_sell_mint.key,
        send_token_account.key,
        taker.key,
        &[&taker.key],
        sell_amount,
        sell_mint_decimal,
    )?;

    msg!("Calling the token program to transfer tokens to the escrow's initializer...");
    invoke(
        &transfer_from_taker_ix,
        &[
            taker_sell_mint_ata.clone(),
            taker_sell_mint.clone(),
            send_token_account.clone(),
            taker.clone(),
            token_program.clone(),
        ],
    )?;

    let buy_mint_decimal = Mint::unpack(&taker_buy_mint.data.borrow())?.decimals;

    let transfer_to_taker_ix = spl_token::instruction::transfer_checked(
        token_program.key,
        escrow_token_account.key,
        taker_buy_mint.key,
        taker_buy_mint_ata.key,
        escrow_account.key,
        &[&escrow_account.key],
        buy_amount,
        buy_mint_decimal,
    )?;

    let prefix: &[u8] = b"escrow";

    msg!("Calling the token program to transfer tokens to the taker...");
    invoke_signed(
        &transfer_to_taker_ix,
        &[
            escrow_token_account.clone(),
            taker_buy_mint.clone(),
            taker_buy_mint_ata.clone(),
            escrow_account.clone(),
            token_program.clone(),
        ],
        &[&[
            b"escrow",
            authority.key.as_ref(),
            escrow_info.sell_mint.as_ref(),
            &[escrow_info.bump],
        ]],
    )?;

    let close_pdas_temp_acc_ix = spl_token::instruction::close_account(
        token_program.key,
        escrow_token_account.key,
        authority.key,
        &escrow_account.key,
        &[&escrow_account.key],
    )?;

    msg!("Calling the token program to close pda's temp account...");
    invoke_signed(
        &close_pdas_temp_acc_ix,
        &[
            escrow_token_account.clone(),
            escrow_account.clone(),
            authority.clone(),
            token_program.clone(),
        ],
        &[&[
            b"escrow",
            authority.key.as_ref(),
            escrow_info.sell_mint.as_ref(),
            &[escrow_info.bump],
        ]],
    )?;

    msg!("Closing the escrow account...");
    **authority.try_borrow_mut_lamports()? = authority
        .lamports()
        .checked_add(escrow_account.lamports())
        .ok_or(EscrowError::AmountOverflow)?;
    **escrow_account.try_borrow_mut_lamports()? = 0;
    *escrow_account.try_borrow_mut_data()? = &mut [];

    Ok(())
}
