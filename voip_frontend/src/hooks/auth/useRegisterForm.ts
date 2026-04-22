import { useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { useAuth } from "@/hooks/auth/useAuth";

type RegisterFormData = {
  username: string;
  password: string;
  confirmPassword: string;
};

function validateUsername(username: string): string | undefined {
  if (username.length < 3) {
    return "Username must be at least 3 characters";
  }
  if (username.length > 128) {
    return "Username must be less than 128 characters";
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return "Username can only contain letters, numbers and underscores";
  }
}

function validatePassword(password: string): string | undefined {
  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (password.length > 128) {
    return "Password must be less than 128 characters";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
}

function validateConfirmPassword(
  confirmPassword: string,
  password: string,
): string | undefined {
  if (confirmPassword.length < 8) {
    return "Confirm Password must be at least 8 characters";
  }
  if (confirmPassword.length > 128) {
    return "Confirm Password must be less than 128 characters";
  }
  if (confirmPassword !== password) {
    return "Passwords do not match";
  }
}

const registerResolver: Resolver<RegisterFormData> = async (values) => {
  const errors: Record<string, { type: string; message: string }> = {};

  const usernameError = validateUsername(values.username);
  if (usernameError) {
    errors.username = { type: "validate", message: usernameError };
  }

  const passwordError = validatePassword(values.password);
  if (passwordError) {
    errors.password = { type: "validate", message: passwordError };
  }

  const confirmPasswordError = validateConfirmPassword(
    values.confirmPassword,
    values.password,
  );
  if (confirmPasswordError) {
    errors.confirmPassword = {
      type: "validate",
      message: confirmPasswordError,
    };
  }

  return {
    values: Object.keys(errors).length === 0 ? values : {},
    errors,
  };
};

const useRegisterForm = () => {
  const { register } = useAuth();
  const submitAttempted = useRef(false);

  const form = useForm<RegisterFormData>({
    resolver: registerResolver,
    mode: "onTouched",
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const shouldShowError = (isTouched: boolean, hasError: boolean) =>
    hasError && (isTouched || submitAttempted.current);

  const onSubmit = async (data: RegisterFormData) => {
    await register(data.username, data.password);
  };

  const handleSubmitClick = async () => {
    submitAttempted.current = true;
    const isValid = await form.trigger();
    if (isValid) {
      onSubmit(form.getValues());
    }
  };

  return {
    form,
    shouldShowError,
    handleSubmitClick,
  };
};

export default useRegisterForm;
