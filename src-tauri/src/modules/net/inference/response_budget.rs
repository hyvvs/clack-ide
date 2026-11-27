pub const MAX_PROVIDER_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ResponseByteBudget {
    observed: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResponseLimitExceeded;

impl ResponseByteBudget {
    pub fn account(&mut self, bytes: usize) -> Result<(), ResponseLimitExceeded> {
        let next = self
            .observed
            .checked_add(bytes)
            .ok_or(ResponseLimitExceeded)?;
        if next > MAX_PROVIDER_RESPONSE_BYTES {
            return Err(ResponseLimitExceeded);
        }
        self.observed = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_a_response_up_to_the_exact_byte_limit() {
        let mut budget = ResponseByteBudget::default();
        budget.account(MAX_PROVIDER_RESPONSE_BYTES - 1).unwrap();
        budget.account(1).unwrap();
        assert_eq!(budget.observed, MAX_PROVIDER_RESPONSE_BYTES);
    }

    #[test]
    fn rejects_the_first_byte_over_the_limit_without_advancing_the_budget() {
        let mut budget = ResponseByteBudget::default();
        budget.account(MAX_PROVIDER_RESPONSE_BYTES).unwrap();
        assert_eq!(budget.account(1), Err(ResponseLimitExceeded));
        assert_eq!(budget.observed, MAX_PROVIDER_RESPONSE_BYTES);
    }

    #[test]
    fn rejects_a_single_oversized_chunk() {
        let mut budget = ResponseByteBudget::default();
        assert_eq!(
            budget.account(MAX_PROVIDER_RESPONSE_BYTES + 1),
            Err(ResponseLimitExceeded)
        );
        assert_eq!(budget.observed, 0);
    }

    #[test]
    fn rejects_cumulative_small_chunks_one_byte_over_the_limit() {
        let mut budget = ResponseByteBudget::default();
        budget.account(MAX_PROVIDER_RESPONSE_BYTES / 2).unwrap();
        budget.account(MAX_PROVIDER_RESPONSE_BYTES / 2).unwrap();
        assert_eq!(budget.account(1), Err(ResponseLimitExceeded));
        assert_eq!(budget.observed, MAX_PROVIDER_RESPONSE_BYTES);
    }
}
