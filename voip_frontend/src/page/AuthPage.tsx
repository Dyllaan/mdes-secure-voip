import { useState } from "react";
import { useAuth } from "@/hooks/auth/useAuth";
import Section from "@/components/layout/Section";
import LoginForm from "@/components/auth/forms/LoginForm";
import RegisterForm from "@/components/auth/forms/RegisterForm";
import MfaForm from "@/components/auth/forms/MfaForm";

function AuthSwitcher({
  isLogin,
  onToggle,
}: {
  isLogin: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1.5 pt-4 text-sm text-muted-foreground">
      <span>
        {isLogin ? "Don't have an account?" : "Already have an account?"}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors"
        data-testid={isLogin ? "switch-to-register" : "switch-to-login"}
      >
        {isLogin ? "Sign up" : "Sign in"}
      </button>
    </div>
  );
}

export default function AuthPage({
  mode = "login",
}: {
  mode?: "login" | "register";
}) {
  const [isLogin, setIsLogin] = useState(mode === "login");
  const { mfaRequired } = useAuth();


  const toggleAuthMode = () => {
    setIsLogin(!isLogin);
  };

  if (mfaRequired) {
    return (
      <div className="w-full max-w-md mx-auto p-6 pt-12">
        <MfaForm onSuccess={() => {}} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 pt-12">
      <Section title={isLogin ? "Login" : "Register"}>
        {isLogin ? <LoginForm /> : <RegisterForm />}
        <AuthSwitcher isLogin={isLogin} onToggle={toggleAuthMode} />
      </Section>
    </div>
  );
}
