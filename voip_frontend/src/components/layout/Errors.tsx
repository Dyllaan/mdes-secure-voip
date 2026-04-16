import { AlertCircle, CheckCircle } from 'lucide-react';
import type { ValidationResult } from '@/utils/validation/Validator';

export default function Errors({ errors }: { errors: ValidationResult[] }) {
  const allErrors = errors.flatMap((r) => r.errors);
  const hasErrors = allErrors.length > 0;

  return (
    <div className="rounded-lg border px-4 py-3 w-96 mx-auto">
        <div className="space-y-2 flex flex-col">
            <div className="mx-auto items-center">
            {hasErrors ? (
                <AlertCircle className="w-5 h-5 text-destructive" />
            ) : (
                <CheckCircle className="w-5 h-5 text-green-500" />
            )}
            </div>

            <ul className="space-y-1">
            {allErrors.map((msg, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                {msg}
                </li>
            ))}
            </ul>
        </div>
        </div>
  );
}