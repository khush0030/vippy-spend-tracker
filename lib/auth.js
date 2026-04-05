import GoogleProvider from "next-auth/providers/google";
import { getSupabase } from "@/lib/supabase";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.email = profile.email;
        token.name = profile.name;
        token.picture = profile.picture;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.user.id = token.sub;
      return session;
    },
    async signIn({ user, account, profile }) {
      // Upsert user to Supabase on every sign-in
      try {
        await getSupabase()
          .from("users")
          .upsert({
            id: user.id,
            email: profile.email,
            name: profile.name,
            avatar_url: profile.picture,
            provider: account.provider,
            last_login: new Date().toISOString(),
          }, { onConflict: "id" });
      } catch {
        // Don't block sign-in if DB write fails
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
};
