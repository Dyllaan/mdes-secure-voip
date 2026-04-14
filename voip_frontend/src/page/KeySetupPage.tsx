import { useState, useCallback } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { RefreshCw, ShieldCheck, KeyRound, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { generateNewMnemonic, isMnemonicValid, deriveDeviceIdentity } from '@/crypto/mnemonicKey';
import { CryptKeyStorage } from '@/utils/CryptKeyStorage';
import { useAuth } from '@/hooks/auth/useAuth';
import KeyErrorPage from '@/components/layout/KeyErrorPage';

function formatError(err: unknown): string {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

async function persistIdentityAndRedirect(mnemonic: string, navigate: NavigateFunction, userId: string): Promise<void> {
    const identity = await deriveDeviceIdentity(mnemonic);
    const storage = await CryptKeyStorage.open(userId);
    await storage.initFromDerived(identity.keyPair, identity.publicKeySpki, identity.deviceId);
    navigate('/', { replace: true });
}

function GenerateTab({ userId }: { userId: string }) {
    const navigate = useNavigate();
    const [mnemonic, setMnemonic] = useState<string>(() => generateNewMnemonic());
    const [confirmed, setConfirmed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const words = mnemonic.split(' ');

    const handleRefresh = useCallback(() => {
        setMnemonic(generateNewMnemonic());
        setConfirmed(false);
        setError(null);
    }, []);

    const handleCreate = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            await persistIdentityAndRedirect(mnemonic, navigate, userId);
        } catch (err) {
            setError(formatError(err));
            setLoading(false);
        }
    }, [mnemonic, navigate, userId]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="space-y-1">
                <h2 className="text-lg font-semibold">Your Recovery Phrase</h2>
                <p className="text-sm text-muted-foreground">
                    Write down these 24 words in order and keep them somewhere safe.
                    They are the only way to recover your account on a new device.
                    Anyone with these words has full access to your encrypted messages.
                </p>
            </div>

            {/* Word grid */}
            <div className="relative rounded-lg border bg-muted/30 p-4">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {words.map((word, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-sm"
                        >
                            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground select-none">
                                {i + 1}.
                            </span>
                            <span className="font-mono font-medium">{word}</span>
                        </div>
                    ))}
                </div>

                {/* Refresh button */}
                <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Generate new phrase"
                >
                    <RefreshCw className="h-4 w-4" />
                </button>
            </div>

            {/* Confirmation checkbox */}
            <div className="flex items-start gap-3 rounded-lg border p-4">
                <Checkbox
                    id="confirmed"
                    checked={confirmed}
                    onCheckedChange={v => setConfirmed(v === true)}
                    disabled={loading}
                    className="mt-0.5"
                />
                <label htmlFor="confirmed" className="text-sm leading-snug cursor-pointer select-none">
                    I have safely written down or stored my 24-word recovery phrase offline.
                    I understand that losing it means permanent loss of access to my encrypted messages.
                </label>
            </div>

            {/* Error */}
            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Action */}
            <Button
                onClick={handleCreate}
                disabled={!confirmed || loading}
                className="w-full"
                size="lg"
            >
                {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating keys…
                    </>
                ) : (
                    <>
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Create Account
                    </>
                )}
            </Button>
        </div>
    );
}

function ImportTab({ userId }: { userId: string }) {
    const navigate = useNavigate();
    const [raw, setRaw] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Split on any whitespace to be forgiving about paste formatting
    const words = raw.trim() === '' ? [] : raw.trim().split(/\s+/);
    const wordCount = words.length;
    const ready = wordCount === 24;

    const handleImport = useCallback(async () => {
        const phrase = words.join(' ');
        if (!isMnemonicValid(phrase)) {
            setError('Invalid recovery phrase - check that all 24 words are spelled correctly and try again.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            await persistIdentityAndRedirect(phrase, navigate, userId);
        } catch (err) {
            setError(formatError(err));
            setLoading(false);
        }
    }, [words, navigate, userId]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="space-y-1">
                <h2 className="text-lg font-semibold">Import Recovery Phrase</h2>
                <p className="text-sm text-muted-foreground">
                    Enter your 24-word recovery phrase, separated by spaces. This will
                    restore your encrypted identity on this device.
                </p>
            </div>

            {/* Textarea */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label htmlFor="mnemonic-input" className="text-sm font-medium">
                        Recovery phrase
                    </label>
                    <Badge
                        variant={ready ? 'default' : 'secondary'}
                        className="tabular-nums"
                    >
                        {wordCount} / 24 words
                    </Badge>
                </div>
                <textarea
                    id="mnemonic-input"
                    value={raw}
                    onChange={e => {
                        setRaw(e.target.value);
                        setError(null);
                    }}
                    disabled={loading}
                    placeholder="word1 word2 word3 … word24"
                    rows={5}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    className="w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
            </div>

            {/* Error */}
            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Action */}
            <Button
                onClick={handleImport}
                disabled={!ready || loading}
                className="w-full"
                size="lg"
            >
                {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Importing keys…
                    </>
                ) : (
                    <>
                        <KeyRound className="mr-2 h-4 w-4" />
                        Import &amp; Continue
                    </>
                )}
            </Button>
        </div>
    );
}

export default function KeySetupPage() {
    const { user } = useAuth();

    if (!user || !user?.sub) {
        return (
            <KeyErrorPage />
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <div className="w-full max-w-2xl space-y-6">
                {/* Title */}
                <div className="text-center space-y-2">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <KeyRound className="h-6 w-6 text-primary" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Set Up Encryption Keys</h1>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto">
                        Your messages are end-to-end encrypted. Before you can start, you need to
                        generate or import a recovery phrase that protects your encryption keys.
                    </p>
                </div>

                {/* Tabs */}
                <div className="rounded-xl border bg-card shadow-sm p-6">
                    <Tabs defaultValue="generate">
                        <TabsList className="w-full mb-6">
                            <TabsTrigger value="generate" className="flex-1">
                                Generate New
                            </TabsTrigger>
                            <TabsTrigger value="import" className="flex-1">
                                Import Existing
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="generate" className="mt-0">
                            <GenerateTab userId={user.sub} />
                        </TabsContent>

                        <TabsContent value="import" className="mt-0">
                            <ImportTab userId={user.sub} />
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Footer note */}
                <p className="text-center text-xs text-muted-foreground">
                    Your recovery phrase never leaves this device and is not sent to any server.
                </p>
            </div>
        </div>
    );
}
