// Test helper: makes an account the way a person does. With email set up, sign-up sends a
// 6-digit code; it is read from the fake mailbox (`sent`) and typed back to finish.
export async function signUp(accounts, input, sent) {
  const r = await accounts.register(input);
  if (!r.otp) return r;
  const code = sent.at(-1).text.match(/(\d{3}) (\d{3})/).slice(1).join('');
  return accounts.verifySignup({ challenge: r.otp.challenge, code });
}
