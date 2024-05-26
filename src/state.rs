use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
#[derive(BorshDeserialize, BorshSerialize, Debug)]
pub struct Escrow {
    pub is_initialized: bool,
    pub authority: Pubkey,
    pub sell_mint: Pubkey,
    pub buy_mint: Pubkey,
    pub buy_amount: u64,
    pub receive_account: Pubkey,
    pub bump: u8,
}
