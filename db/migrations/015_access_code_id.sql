-- Seam's id for a session's keypad code, so the code can be revoked on the
-- lock when the borrower opens the door another way (e.g. the on-demand
-- unlock button) and no longer needs it.
alter table public.borrow_sessions add column access_code_id text;
