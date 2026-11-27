import { describe, expect, it } from 'vitest';
import { changeEmail, EmailInput, type AccountDeps } from '../src/account';

const id = '11111111-1111-4111-8111-111111111111';
const env = { LINKS_HANDOFF_USERS: id } as never;
const me = { userId: id, email: 'hello@malindaperryconsulting.com' };

function deps(password = 'right-one', taken: string[] = []) {
  const set: string[] = [];
  const d: AccountDeps = {
    checkPassword: async (_e, _email, p) => p === password,
    setEmail: async (_e, _u, email) => (taken.includes(email) ? 'taken' : (set.push(email), 'ok')),
  };
  return { d, set };
}

describe('cockpit: change the sign-in email without a confirmation email', () => {
  it('changes it right away when the current password is right', async () => {
    const { d, set } = deps();
    const input = EmailInput.parse({ email: ' New@MalindaPerryConsulting.com ', password: 'right-one' });
    await expect(changeEmail(env, me, input, d)).resolves.toEqual({ email: 'new@malindaperryconsulting.com', changed: true });
    expect(set).toEqual(['new@malindaperryconsulting.com']);
  });
  it('refuses a wrong password, a taken address, and accounts other than the owner', async () => {
    const { d, set } = deps('right-one', ['taken@example.com']);
    await expect(changeEmail(env, me, { email: 'new@example.com', password: 'wrong' }, d)).rejects.toMatchObject({ status: 403, code: 'wrong_password' });
    await expect(changeEmail(env, me, { email: 'taken@example.com', password: 'right-one' }, d)).rejects.toMatchObject({ status: 409, code: 'email_taken' });
    await expect(changeEmail(env, { ...me, userId: '22222222-2222-4222-8222-222222222222' }, { email: 'new@example.com', password: 'right-one' }, d)).rejects.toMatchObject({ code: 'owner_id_not_set' });
    expect(set).toEqual([]);
  });
  it('does nothing when the email is the same', async () => {
    const { d, set } = deps();
    await expect(changeEmail(env, me, { email: 'hello@malindaperryconsulting.com', password: 'x' }, d)).resolves.toMatchObject({ changed: false });
    expect(set).toEqual([]);
  });
});
