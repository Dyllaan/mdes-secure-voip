import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Lock, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import MfaSetupDialog from '@/components/auth/dialog/MfaSetupDialog';
import { useAuth } from "@/hooks/auth/useAuth";
import Validator, { type ValidationResult } from '@/utils/validation/Validator';
import Errors from '@/components/layout/Errors';

interface RegisterFormProps {
  onSuccess: () => void;
  onToggleMode: () => void;
}

interface FormValues {
  username: string;
  password: string;
  confirmPassword: string;
}

const validator = new Validator();

export default function RegisterForm({ onSuccess, onToggleMode }: RegisterFormProps) {
  const { register: registerAuth } = useAuth();

  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting, errors: formErrors },
  } = useForm<FormValues>({ mode: 'onChange' });

  const [showMfaSetup, setShowMfaSetup] = useState(false);

  const watchedValues = watch();

  const [validationErrors, setValidationErrors] = useState<ValidationResult[]>([]);

  useEffect(() => {
    const results: ValidationResult[] = [];

    if (watchedValues.username) {
      const result = validator.validate('Username', watchedValues.username);
      if (!result.valid) results.push(result);
    }

    if (watchedValues.password) {
      const result = validator.validate('Password', watchedValues.password);
      if (!result.valid) results.push(result);
    }

    if (watchedValues.password && watchedValues.confirmPassword) {
      if (watchedValues.password !== watchedValues.confirmPassword) {
        results.push({ valid: false, errors: ['Passwords do not match'] });
      }
    }

    // Merge RHF built-in errors (required, minLength) as ValidationResult
    Object.values(formErrors).forEach((error) => {
      if (error?.message) {
        results.push({ valid: false, errors: [error.message] });
      }
    });

    setValidationErrors(results);
  }, [watchedValues.username, watchedValues.password, watchedValues.confirmPassword, formErrors]);


  const onSubmit = async (data: FormValues) => {
    // Block submit if custom validator found issues
    if (validationErrors.length > 0) return;

    try {
      const result = await registerAuth(data.username, data.password);

      if (result.success) {
        toast.success('Account created successfully!');
        onSuccess();
      } else if (result.mfaRequired) {
        setShowMfaSetup(true);
        toast.info('Please set up two-factor authentication');
      } else {
        toast.error(result.error || 'Registration failed');
      }
    } catch (error) {
      console.error('Registration failed:', error);
      toast.error('An unexpected error occurred');
    }
  };

  const handleMfaSetupComplete = () => onSuccess();
  const handleSkipMfa = () => { setShowMfaSetup(false); onSuccess(); };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4 w-96 mx-auto p-6">

        {/* Username */}
        <div className="space-y-2">
          <Label htmlFor="username" className="flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-muted-foreground" />
            Username
          </Label>
          <Input
            id="username"
            data-testid="username-input"
            type="text"
            placeholder="Choose a username"
            disabled={isSubmitting}
            autoComplete="username"
            {...register('username', { required: 'Username is required' })}
          />
        </div>

        {/* Password */}
        <div className="space-y-2">
          <Label htmlFor="password" className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            Password
          </Label>
          <Input
            id="password"
            data-testid="password-input"
            type="password"
            placeholder="Create a password"
            disabled={isSubmitting}
            autoComplete="new-password"
            {...register('password', {
              required: 'Password is required',
              minLength: { value: 8, message: 'Password must be at least 8 characters' },
            })}
          />
        </div>

        {/* Confirm Password */}
        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
          <Label htmlFor="confirmPassword" className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            Confirm Password
          </Label>
          <Input
            id="confirmPassword"
            data-testid="confirm-password-input"
            type="password"
            placeholder="Confirm your password"
            disabled={isSubmitting}
            autoComplete="new-password"
            {...register('confirmPassword', { required: 'Please confirm your password' })}
          />
        </div>

        {/* Submit */}
        <Button
          type="submit"
          data-testid="register-submit"
          disabled={isSubmitting || validationErrors.length > 0}
          className="w-full mt-6"
        >
          {isSubmitting ? 'Creating account...' : 'Create Account'}
        </Button>

        {/* Toggle to Login */}
        <div className="pt-4 text-center">
          <button
            type="button"
            data-testid="switch-to-login"
            onClick={onToggleMode}
            disabled={isSubmitting}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Already have an account?{' '}
            <span className="text-primary font-medium">Sign in</span>
          </button>
        </div>
      </form>

      {/* Live validation errors from Validator class + RHF required errors */}
      <Errors errors={validationErrors} />

      <MfaSetupDialog
        open={showMfaSetup}
        onOpenChange={(open) => { if (!open) handleSkipMfa(); }}
        onComplete={handleMfaSetupComplete}
      />
    </>
  );
}