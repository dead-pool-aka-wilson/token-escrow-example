use borsh::BorshDeserialize;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey};

use crate::instructions::*;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = EscrowInstruction::try_from_slice(instruction_data)?;

    match instruction {
        EscrowInstruction::InitEscrow {
            sell_amount,
            buy_amount,
        } => {
            msg!("Instruction: InitEscrow");
            initialize::process_init_escrow(accounts, sell_amount, buy_amount, program_id)
        }
        EscrowInstruction::Exchange {
            sell_amount,
            buy_amount,
        } => {
            msg!("Instruction: Exchange");
            exchange::process_exchange(accounts, sell_amount, buy_amount, program_id)
        }
    }
}
