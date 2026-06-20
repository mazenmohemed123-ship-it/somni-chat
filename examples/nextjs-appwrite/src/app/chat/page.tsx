/**
 * App Router page — /chat
 *
 * In a real app, replace `MOCK_USER_ID` with your auth system:
 *   const session = await getServerSession(authOptions);
 *   if (!session) redirect('/login');
 *   const userId = session.user.id;
 */
import ChatApp from '../../components/ChatApp';

const MOCK_USER_ID = 'user_demo_001';

export default function ChatPage() {
  return (
    <div style={{ height: '100vh', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
          Somni Chat — Appwrite + Next.js 14
        </h1>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatApp userId={MOCK_USER_ID} />
      </div>
    </div>
  );
}
