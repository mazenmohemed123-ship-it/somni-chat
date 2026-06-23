import type { Auth, User } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
} from 'firebase/auth';

export type AuthState = { userId: string | null; user: User | null };
export type AuthStateListener = (state: AuthState) => void;

/**
 * Thin, testable bridge between Firebase Auth and the chat engine.
 * Mirrors the SupabaseAuth API so you can swap backends without rewriting
 * your auth integration code.
 *
 * @example
 * const auth = new FirebaseAuth(firebaseAuth);
 * const userId = await auth.getCurrentUserId();
 * const chat = createChat({ adapter, userId });
 * auth.onAuthStateChange(({ userId }) => {
 *   if (userId) chat.connect(userId);
 *   else chat.disconnect();
 * });
 */
export class FirebaseAuth {
  private readonly auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  /** Returns the UID of the currently signed-in user, or null. */
  getCurrentUserId(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  /** Returns the full Firebase User object, or null. */
  getCurrentUser(): User | null {
    return this.auth.currentUser;
  }

  /** Returns the current ID token (JWT), refreshing if necessary. */
  async getAccessToken(): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) return null;
    return user.getIdToken();
  }

  /**
   * Registers an auth state change listener.
   * Returns a cleanup function — call it to unsubscribe.
   */
  onAuthStateChange(listener: AuthStateListener): () => void {
    return onAuthStateChanged(this.auth, (user) => {
      listener({ userId: user?.uid ?? null, user: user ?? null });
    });
  }

  async signInWithEmailPassword(email: string, password: string): Promise<string> {
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user.uid;
  }

  async signInWithGoogle(): Promise<string> {
    const cred = await signInWithPopup(this.auth, new GoogleAuthProvider());
    return cred.user.uid;
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }
}
