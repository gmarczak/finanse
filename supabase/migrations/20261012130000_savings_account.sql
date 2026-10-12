-- Konto oszczędnościowe (np. Revolut Oszczędności) jako osobny rodzaj konta.
-- Przelew na nie to przelew między własnymi kontami, nie wydatek.
alter type finance.account_kind add value if not exists 'savings' after 'bank';
