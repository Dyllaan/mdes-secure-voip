import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";
import useRegisterForm from "@/hooks/auth/useRegisterForm";
import { User } from "lucide-react";
import PasswordInput from "@/components/auth/forms/PasswordInput";

export default function RegisterForm() {
  const { form, handleSubmitClick, shouldShowError } = useRegisterForm();

  return (
    <Form {...form}>
      <form className="space-y-4">
        <div className="space-y-2">
          <FormField
            control={form.control}
            name="username"
            render={({ field, fieldState }) => (
              <FormItem>
                <Label
                  htmlFor="username"
                  className="flex items-center gap-2 text-base"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  Username
                </Label>
                <FormControl>
                  <Input
                    {...field}
                    type="text"
                    placeholder="Username"
                    data-testid="username-input"
                    className={cn(
                      "text-base h-12",
                      shouldShowError(
                        fieldState.isTouched,
                        !!fieldState.error,
                      ) && "bg-red-50 dark:bg-red-900/20 border-red-500",
                    )}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <FormItem>
                <Label
                  htmlFor="password"
                  className="flex items-center gap-2 text-base"
                >
                  <Lock className="w-4 h-4 text-muted-foreground" />
                  Password
                </Label>
                <FormControl>
                  <PasswordInput
                    {...field}
                    type="password"
                    placeholder="Password"
                    data-testid="password-input"
                    className={cn(
                      "text-base h-12",
                      shouldShowError(
                        fieldState.isTouched,
                        !!fieldState.error,
                      ) && "bg-red-50 dark:bg-red-900/20 border-red-500",
                    )}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field, fieldState }) => (
              <FormItem>
                <Label
                  htmlFor="confirmPassword"
                  className="flex items-center gap-2 text-base"
                >
                  <Lock className="w-4 h-4 text-muted-foreground" />
                  Confirm Password
                </Label>
                <FormControl>
                  <PasswordInput
                    {...field}
                    type="password"
                    placeholder="Confirm Password"
                    data-testid="confirm-password-input"
                    className={cn(
                      "text-base h-12",
                      shouldShowError(
                        fieldState.isTouched,
                        !!fieldState.error,
                      ) && "bg-red-50 dark:bg-red-900/20 border-red-500",
                    )}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        </div>

        <Button
          type="button"
          className="w-full mt-6"
          onClick={handleSubmitClick}
          data-testid="register-submit"
        >
          Create Account
        </Button>
      </form>
    </Form>
  );
}
