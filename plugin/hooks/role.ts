export const roleOf = (nlkHost?: string, nlkRole?: string): 'host' | 'worker' | 'remote' => (nlkRole === 'worker' ? 'worker' : nlkHost === '1' ? 'host' : 'remote')
