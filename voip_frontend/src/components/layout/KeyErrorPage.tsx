import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';


export default function KeyErrorPage() {
    return (
            <div className="flex min-h-screen items-center justify-center bg-background p-4">
                <div className="w-full max-w-md space-y-6 text-center">
                    <Alert variant="destructive" className="space-y-2"> 
                        <AlertCircle className="mx-auto h-6 w-6" />
                        <AlertDescription>
                            You must be logged in to set up your encryption keys.
                        </AlertDescription>
                    </Alert>
                    <Button
                        onClick={() => window.location.href = '/login'}
                        variant="outline"
                        className="w-full"
                    >
                        Go to Login
                    </Button>
                </div>
            </div>
    );
}