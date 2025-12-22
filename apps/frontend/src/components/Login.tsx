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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-soft p-4 dark:bg-gradient-soft-dark">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.15),transparent_50%)]"></div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.15),transparent_50%)]"></div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-neutral-200 bg-white/90 p-10 shadow-large backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/90">
        <div className="mb-10 flex items-center gap-4">
          <div className="relative overflow-hidden">
            <img
              src="/images/helpmaton_logo.svg"
              alt="Helmaton Logo"
              className="relative z-10 size-16"
            />
            <div
              className="manga-shine-overlay pointer-events-none absolute inset-0 z-20"
              style={{
                background:
                  "radial-gradient(circle at center, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.4) 15%, transparent 30%), linear-gradient(45deg, transparent 25%, rgba(255, 255, 255, 0.3) 45%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0.3) 55%, transparent 75%)",
                width: "200%",
                height: "200%",
              }}
            ></div>
            <div className="absolute inset-0 rounded-full bg-gradient-primary opacity-20 blur-xl"></div>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
            Helpmaton
          </h1>
        </div>
        <h2 className="mb-10 text-3xl font-bold text-neutral-900 dark:text-neutral-50">Sign in</h2>

        <form onSubmit={handleEmailSignIn} className="space-y-6">
          <div>
            <label
              htmlFor="email"
              className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
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
              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:placeholder:text-neutral-400 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              placeholder="your@email.com"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !email.trim()}
            className="w-full transform rounded-xl bg-gradient-primary px-4 py-3.5 font-semibold text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-colored active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
          >
            {isSubmitting ? "Sending..." : "Send sign-in link"}
          </button>
        </form>

        {status === "authenticated" && (
          <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-300">
            Check your email for the sign-in link.
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;
