import { redirect } from 'next/navigation';
import SignupNameForm from '@/components/SignupNameForm';
import { getCurrentUser } from '@/lib/auth';
import { peekSignup } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/**
 * Выбор имени для того, кто только что вошёл через провайдера впервые.
 *
 * Экран существует ровно столько, сколько живёт начатая регистрация: своим
 * адресом сюда не попасть — без неё смотреть тут нечего, и человек уезжает на
 * экран входа.
 */
export default async function WelcomePage() {
  // Вошедшему регистрироваться незачем: он мог вернуться кнопкой «назад» уже
  // после того, как аккаунт появился.
  const user = await getCurrentUser();
  if (user) redirect('/tournaments');

  const pending = await peekSignup();
  if (!pending) redirect('/');

  return <SignupNameForm suggestion={pending.suggestion} />;
}
