import { useSession, signIn } from "next-auth/react";
import { useState } from "react";
import type { FC } from "react";

const Login: FC = () => {
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    try {
      await signIn("email", {
        email: email.trim(),
        callbackUrl: window.location.href,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isSubmitting && email.trim()) {
      e.preventDefault();
      handleEmailSignIn(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-soft dark:bg-gradient-soft-dark p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.15),transparent_50%)] pointer-events-none"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.15),transparent_50%)] pointer-events-none"></div>

      <div className="w-full max-w-md bg-white/90 backdrop-blur-sm border border-neutral-200 rounded-2xl shadow-large p-10 relative z-10 dark:bg-neutral-900/90 dark:border-neutral-700">
        <div className="flex items-center gap-4 mb-10">
          <div className="relative overflow-hidden">
            <img
              src="/images/helpmaton_logo.svg"
              alt="Helmaton Logo"
              className="w-16 h-16 relative z-10"
            />
            <div
              className="manga-shine-overlay absolute inset-0 z-20 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle at center, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.4) 15%, transparent 30%), linear-gradient(45deg, transparent 25%, rgba(255, 255, 255, 0.3) 45%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0.3) 55%, transparent 75%)",
                width: "200%",
                height: "200%",
              }}
            ></div>
            <div className="absolute inset-0 bg-gradient-primary opacity-20 rounded-full blur-xl"></div>
          </div>
          <h1 className="text-4xl font-black text-neutral-900 tracking-tight dark:text-neutral-50">
            Helpmaton
          </h1>
        </div>
        <h2 className="mb-10 text-3xl font-bold text-neutral-900 dark:text-neutral-50">Sign in</h2>

        <form onSubmit={handleEmailSignIn} className="space-y-6">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-neutral-700 mb-2.5 dark:text-neutral-300"
            >
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:placeholder:text-neutral-400 dark:focus:ring-primary-400 dark:focus:border-primary-500"
              placeholder="your@email.com"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !email.trim()}
            className="w-full bg-gradient-primary px-4 py-3.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {isSubmitting ? "Sending..." : "Send sign-in link"}
          </button>
        </form>

        {status === "authenticated" && (
          <p className="mt-6 text-sm text-neutral-600 text-center dark:text-neutral-300">
            Check your email for the sign-in link.
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;
