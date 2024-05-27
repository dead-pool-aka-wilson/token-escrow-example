use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
#[derive(BorshDeserialize, BorshSerialize, Debug)]
pub struct Escrow {
    pub is_initialized: bool,
    pub authority: Pubkey,
    pub sell_mint: Pubkey,
    pub buy_mint: Pubkey,
    pub sell_amount: u64,
    pub buy_amount: u64,
    pub receive_account: Pubkey,
    pub bump: u8,
}

impl Escrow {
    pub fn new(
        is_initialized: bool,
        authority: Pubkey,
        sell_mint: Pubkey,
        buy_mint: Pubkey,
        sell_amount: u64,
        buy_amount: u64,
        receive_account: Pubkey,
        bump: u8,
    ) -> Self {
        Self {
            is_initialized,
            authority,
            sell_mint,
            buy_mint,
            sell_amount,
            buy_amount,
            receive_account,
            bump,
        }
    }

    pub fn len() -> usize {
        1 + 32 + 32 + 32 + 8 + 8 + 32 + 1
    }
}
