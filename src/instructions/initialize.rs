use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};

use spl_associated_token_account::instruction::create_associated_token_account;
use spl_token::state::Mint;

use crate::{error::EscrowError, state::Escrow};

pub fn process_init_escrow(
    accounts: &[AccountInfo],
    sell_amount: u64,
    buy_amount: u64,
    program_id: &Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let sell_mint = next_account_info(account_info_iter)?;
    let buy_mint = next_account_info(account_info_iter)?;

    let authority = next_account_info(account_info_iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let authority_sell_mint_ata = next_account_info(account_info_iter)?;
    let authority_buy_mint_ata = next_account_info(account_info_iter)?;

    let escrow_account = next_account_info(account_info_iter)?;
    let escrow_token_account = next_account_info(account_info_iter)?;

    let rent = &Rent::from_account_info(next_account_info(account_info_iter)?)?;
    let system_program = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

    if !rent.is_exempt(escrow_account.lamports(), escrow_account.data_len()) {
        return Err(EscrowError::NotRentExempt.into());
    }

    let (pda, bump) = Pubkey::find_program_address(
        &[b"escrow", authority.key.as_ref(), sell_mint.key.as_ref()],
        program_id,
    );

    if pda != *escrow_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let mut escrow_info = Escrow::try_from_slice(&escrow_account.try_borrow_data()?)?;
    if escrow_info.is_initialized {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    escrow_info.is_initialized = true;
    escrow_info.authority = *authority.key;
    escrow_info.sell_mint = *sell_mint.key;
    escrow_info.buy_mint = *buy_mint.key;
    escrow_info.buy_amount = buy_amount;
    escrow_info.receive_account = *authority_buy_mint_ata.key;
    escrow_info.bump = bump;

    let mut buffer: Vec<u8> = Vec::new();
    escrow_info.serialize(&mut buffer).unwrap();
    let data_len = buffer.len();

    let required_lamport = rent.minimum_balance(data_len);
    let escrow_create_ix = system_instruction::create_account(
        authority.key,
        escrow_account.key,
        required_lamport,
        data_len as u64,
        program_id,
    );

    msg!("Calling the system program to create escrow account...");
    invoke_signed(
        &escrow_create_ix,
        &[
            authority.clone(),
            escrow_account.clone(),
            system_program.clone(),
        ],
        &[&[
            b"escrow",
            authority.key.as_ref(),
            escrow_info.sell_mint.as_ref(),
            &[escrow_info.bump],
        ]],
    )?;

    escrow_info.serialize(&mut &mut escrow_account.data.borrow_mut()[..])?;

    let sell_mint_decimal = Mint::unpack(&sell_mint.data.borrow())?.decimals;

    let transfer_token_ix = spl_token::instruction::transfer_checked(
        token_program.key,
        authority_sell_mint_ata.key,
        sell_mint.key,
        escrow_token_account.key,
        authority.key,
        &[authority.key],
        sell_amount,
        sell_mint_decimal,
    )?;

    msg!("Calling the token program to transfer token account ownership...");
    invoke(
        &transfer_token_ix,
        &[
            token_program.clone(),
            authority_sell_mint_ata.clone(),
            sell_mint.clone(),
            escrow_token_account.clone(),
            authority.clone(),
        ],
    )?;

    Ok(())
}
