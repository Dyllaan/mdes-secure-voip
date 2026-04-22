import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/auth/useAuth";
import * as z from "zod";

const registerSchema = z
  .object({
    username: z
      .string()
      .min(3, "Username must be at least 3 characters")
      .max(128, "Username must be less than 128 characters")
      .regex(
        /^[a-zA-Z0-9_]+$/,
        "Username can only contain letters, numbers and underscores",
      ),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be less than 128 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z
      .string()
      .min(8, "Confirm Password must be at least 8 characters")
      .max(128, "Confirm Password must be less than 128 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

const useRegisterForm = () => {
  const { register } = useAuth();
  const submitAttempted = useRef(false);

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
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
