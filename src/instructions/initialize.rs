use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::{self, Pubkey},
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};

use spl_associated_token_account::instruction::{
    create_associated_token_account, AssociatedTokenAccountInstruction,
};
use spl_token::state::Mint;

use crate::{error::EscrowError, state::Escrow};

#[derive(Debug)]
pub struct InitEscrowAccount {
    sell_mint: Pubkey,
    buy_mint: Pubkey,
    authority: Pubkey,
    authority_sell_mint_ata: Pubkey,
    authority_buy_mint_ata: Pubkey,
    escrow_account: Pubkey,
    escrow_token_account: Pubkey,
    rent: Pubkey,
    system_program: Pubkey,
    token_program: Pubkey,
    associated_program: Pubkey,
}

impl InitEscrowAccount {
    pub fn new(
        sell_mint: Pubkey,
        buy_mint: Pubkey,
        authority: Pubkey,
        authority_sell_mint_ata: Pubkey,
        authority_buy_mint_ata: Pubkey,
        escrow_account: Pubkey,
        escrow_token_account: Pubkey,
        rent: Pubkey,
        system_program: Pubkey,
        token_program: Pubkey,
        associated_program: Pubkey,
    ) -> Self {
        Self {
            sell_mint,
            buy_mint,
            authority,
            authority_sell_mint_ata,
            authority_buy_mint_ata,
            escrow_account,
            escrow_token_account,
            rent,
            system_program,
            token_program,
            associated_program,
        }
    }
}

pub fn process_init_escrow(
    accounts: &[AccountInfo],
    sell_amount: u64,
    buy_amount: u64,
    program_id: &Pubkey,
) -> ProgramResult {
    msg!("Reading Accounts List...");
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

    let rent_account = next_account_info(account_info_iter)?;
    let rent = &Rent::from_account_info(rent_account)?;
    let system_program = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let associated_program = next_account_info(account_info_iter)?;

    msg!("Accounts Read Finished...");

    msg!(
        "{:?}",
        InitEscrowAccount::new(
            *sell_mint.key,
            *buy_mint.key,
            *authority.key,
            *authority_sell_mint_ata.key,
            *authority_buy_mint_ata.key,
            *escrow_account.key,
            *escrow_token_account.key,
            *rent_account.key,
            *system_program.key,
            *token_program.key,
            *associated_program.key,
        )
    );

    let (pda, bump) = Pubkey::find_program_address(
        &[b"escrow", authority.key.as_ref(), sell_mint.key.as_ref()],
        program_id,
    );

    if pda != *escrow_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let required_lamport = rent.minimum_balance(Escrow::len());
    let escrow_create_ix = system_instruction::create_account(
        authority.key,
        escrow_account.key,
        required_lamport,
        Escrow::len() as u64,
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
            sell_mint.key.as_ref(),
            &[bump],
        ]],
    )?;

    let mut escrow_info = Escrow::try_from_slice(&escrow_account.try_borrow_data()?)?;
    if escrow_info.is_initialized {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    escrow_info.is_initialized = true;
    escrow_info.authority = *authority.key;
    escrow_info.sell_mint = *sell_mint.key;
    escrow_info.buy_mint = *buy_mint.key;
    escrow_info.sell_amount = sell_amount;
    escrow_info.buy_amount = buy_amount;
    escrow_info.receive_account = *authority_buy_mint_ata.key;
    escrow_info.bump = bump;

    let mut buffer: Vec<u8> = Vec::new();
    escrow_info.serialize(&mut buffer).unwrap();

    escrow_info.serialize(&mut &mut escrow_account.data.borrow_mut()[..])?;

    let sell_mint_decimal = Mint::unpack(&sell_mint.data.borrow())?.decimals;

    let create_escrow_token_account = create_associated_token_account(
        authority.key,
        escrow_account.key,
        &sell_mint.key,
        token_program.key,
    );
    msg!("Calling the associated token program to create escrow token account ownership...");
    invoke(
        &create_escrow_token_account,
        &[
            authority.clone(),
            escrow_account.clone(),
            escrow_token_account.clone(),
            sell_mint.clone(),
            token_program.clone(),
            system_program.clone(),
            associated_program.clone(),
        ],
    )?;

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

    msg!("Calling the token program to transfer token ...");

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
