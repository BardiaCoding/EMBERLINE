import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { createQueryClient } from './queryClient'

interface QueryProviderProps {
  children: ReactNode
  /** Tests pass their own client. The app creates one. */
  client?: QueryClient
}

export function QueryProvider({ children, client }: QueryProviderProps) {
  const [defaultClient] = useState(createQueryClient)
  return <QueryClientProvider client={client ?? defaultClient}>{children}</QueryClientProvider>
}
