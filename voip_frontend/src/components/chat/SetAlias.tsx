import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Save, RefreshCw, Zap } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface SetAliasProps {
    socket: Socket | null;
}

const SetAlias = ({ socket }: SetAliasProps) => {
    const [alias, setAlias] = useState('');
    const [storedAlias, setStoredAlias] = useState(localStorage.getItem('userAlias') || '');

    useEffect(() => {
        if (storedAlias) setAlias(storedAlias);
    }, [storedAlias]);

    const handleSave = () => {
        localStorage.setItem('userAlias', alias);
        setStoredAlias(alias);
        if (socket) {
            socket.emit("alias-updated", { alias });
        }
    };

    const handleReset = () => {
        localStorage.removeItem('userAlias');
        setAlias('');
        setStoredAlias('');
    };

    return (
        <div className="flex flex-col items-center p-8 rounded-2xl max-w-md mx-auto">
            <div className="flex items-center gap-2 mb-4">
                <h2 className="text-2xl font-bold">
                    Set Your Alias
                </h2>
                <Zap className="w-8 h-8 text-blue-400" />
            </div>

            <Input
                placeholder="Enter your alias..."
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                className="mb-4"
            />

            <div className="flex gap-4">
                <Button
                    onClick={handleSave}
                    disabled={!alias || alias === storedAlias}
                >
                    <Save className="mr-2 h-4 w-4" />
                    Save Alias
                </Button>
                <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={!storedAlias}
                    className="border-red-500 text-red-500 hover:bg-red-50"
                >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reset Alias
                </Button>
            </div>

            {storedAlias && (
                <div className="mt-6 bg-gray-800 p-4 rounded-lg shadow-inner">
                    <p className="text-lg">
                        Your current alias is: <strong>{storedAlias}</strong>
                    </p>
                </div>
            )}
        </div>
    );
};

export default SetAlias;