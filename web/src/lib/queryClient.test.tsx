import { useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createQueryClient } from './queryClient'
import { QueryProvider } from './QueryProvider'

function Probe({ calls }: { calls: string[] }) {
  const [key, setKey] = useState('a')
  const { data, isPlaceholderData } = useQuery({
    queryKey: ['probe', key],
    queryFn: async () => {
      calls.push(key)
      if (key === 'b') await new Promise((resolve) => setTimeout(resolve, 60))
      return `data-${key}`
    },
  })
  return (
    <div>
      <p data-testid="data">{data ?? 'none'}</p>
      <p data-testid="placeholder">{String(isPlaceholderData)}</p>
      <button
        onClick={() => {
          setKey('b')
        }}
      >
        to-b
      </button>
      <button
        onClick={() => {
          setKey('a')
        }}
      >
        to-a
      </button>
    </div>
  )
}

describe('createQueryClient', () => {
  it('sets keepPreviousData, no retries and an infinite stale time', () => {
    const options = createQueryClient().getDefaultOptions().queries
    expect(typeof options?.placeholderData).toBe('function')
    expect(options?.retry).toBe(false)
    expect(options?.staleTime).toBe(Infinity)
  })
})

describe('QueryProvider', () => {
  it('keeps the previous data while a new query loads, and reuses a completed query without a new request', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    render(
      <QueryProvider>
        <Probe calls={calls} />
      </QueryProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('data').textContent).toBe('data-a')
    })

    await user.click(screen.getByText('to-b'))
    expect(screen.getByTestId('data').textContent).toBe('data-a')
    expect(screen.getByTestId('placeholder').textContent).toBe('true')
    await waitFor(() => {
      expect(screen.getByTestId('data').textContent).toBe('data-b')
    })
    expect(screen.getByTestId('placeholder').textContent).toBe('false')

    await user.click(screen.getByText('to-a'))
    expect(screen.getByTestId('data').textContent).toBe('data-a')
    expect(calls).toEqual(['a', 'b'])
  })
})
