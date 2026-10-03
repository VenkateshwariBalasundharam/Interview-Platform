import { redirect } from 'next/navigation';

// Candidates only ever see their own login. The admin login is not linked anywhere on the candidate side;
// admins go straight to /staff-login.
export default function Home() {
  redirect('/login');
}
