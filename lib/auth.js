import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
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
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        if (!email || !password) return null;

        const { data: row, error } = await getSupabase()
          .from("users")
          .select("id, email, name, avatar_url, password_hash")
          .eq("email", email)
          .maybeSingle();

        if (error || !row || !row.password_hash) return null;

        const valid = await bcrypt.compare(password, row.password_hash);
        if (!valid) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.name || row.email,
          image: row.avatar_url || null,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account) {
        token.provider = account.provider;
        if (account.provider === "google") {
          token.accessToken = account.access_token;
          token.refreshToken = account.refresh_token;
          token.email = profile?.email;
          token.name = profile?.name;
          token.picture = profile?.picture;
        } else if (account.provider === "credentials" && user) {
          token.sub = user.id;
          token.email = user.email;
          token.name = user.name;
          token.picture = user.image;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.user.id = token.sub;
      session.provider = token.provider;
      return session;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") return true;
      try {
        // Check if user has a custom (non-Google) avatar before overwriting
        const { data: existingUser } = await getSupabase()
          .from("users")
          .select("avatar_url")
          .eq("id", user.id)
          .single();

        const hasCustomAvatar = existingUser?.avatar_url &&
          !existingUser.avatar_url.includes("googleusercontent.com");

        await getSupabase()
          .from("users")
          .upsert({
            id: user.id,
            email: profile?.email,
            name: profile?.name,
            avatar_url: hasCustomAvatar ? existingUser.avatar_url : profile?.picture,
            provider: account?.provider,
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
