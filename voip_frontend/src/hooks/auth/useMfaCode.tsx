import { useState, useMemo } from "react";
import { type ValidationResult } from '@/utils/validation/Validator';
import { toast } from 'sonner';

export default function useMfaCode(
  {
    onSubmit,
    trustDevice = false,
    onSuccess,
  }: {
    onSubmit?: (code: string, trustDevice: boolean) => Promise<{ success: boolean; error?: string }>;
    trustDevice?: boolean;
    onSuccess?: () => void;
  } = {} 
) {
    const [mfaCode, setMfaCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    function validate(code: string): ValidationResult[] {
        const errors: ValidationResult[] = [];
        if (code.length > 0 && code.length < 6) {
            errors.push({ valid: false, errors: [`Code must be 6 digits (${code.length}/6 entered)`] });
        }
        if (code.length > 0 && !/^\d+$/.test(code)) {
            errors.push({ valid: false, errors: ['Code must contain numbers only'] });
        }
        return errors;
    }

    const errors = useMemo(() => submitted ? validate(mfaCode) : [], [mfaCode, submitted]);
    const isValid = mfaCode.length === 6 && errors.length === 0;

    const handleChange = (code: string) => {
        const value = code.replace(/\D/g, '');
        setMfaCode(value);
    };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitted(true);

        const currentErrors = validate(mfaCode);
        if (currentErrors.length > 0) return;

        setIsLoading(true);
        try {
            const result = await onSubmit?.(mfaCode, trustDevice);
            if (result?.success) {
                onSuccess?.();
            } else {
                toast.error(result?.error || 'Invalid authentication code');
                setMfaCode('');
            }
        } catch (error) {
            console.error('MFA verification failed:', error);
            toast.error('An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    }

    return { mfaCode, isLoading, errors, isValid, handleChange, handleSubmit };
}