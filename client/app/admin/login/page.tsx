"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginAdmin } from "../../actions";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await loginAdmin(password);
    if (result.success) {
      router.push("/admin");
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-rh-gray-95">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="border-t-4 border-rh-red-50 -mt-8 -mx-8 mb-6 rounded-t-xl" />
          <h1 className="text-2xl font-rh-display font-bold text-rh-gray-90 mb-2">
            Admin Login
          </h1>
          <p className="text-sm text-rh-gray-50 mb-6">
            GPU Booking Administration
          </p>

          {error && (
            <div className="mb-4 bg-rh-red-10 border border-rh-red-30 text-rh-red-60 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-rh-gray-70 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-rh-gray-20 rounded-lg focus:outline-none focus:border-rh-red-50 focus:ring-1 focus:ring-rh-red-50 transition-colors"
              placeholder="Enter admin password"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full py-3 bg-rh-red-50 hover:bg-rh-red-60 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
