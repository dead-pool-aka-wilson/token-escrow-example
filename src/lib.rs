#[cfg(not(feature = "no-entrypoint"))]
use solana_program::entrypoint;

pub use crate::processor::process_instruction;

pub mod error;
pub mod instructions;
pub mod processor;
pub mod state;

entrypoint!(process_instruction);
