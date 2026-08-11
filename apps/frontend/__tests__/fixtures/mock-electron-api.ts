/**
 * Mock Electron API for UI routing tests
 *
 * Provides isolated testing without actual IPC handlers registered
 */

import { EventEmitter } from 'events';
import { vi } from 'vitest';

export class MockElectronAPI extends EventEmitter {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcRenderer: any;

  constructor() {
    super();

    this.ipcRenderer = {
      on: vi.fn((channel: string, callback: (event: unknown, ...args: unknown[]) => void) => {
        // Store callbacks for later invocation in tests
        this[`on_${channel}`] = callback;
      }),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
      send: vi.fn(),
      invoke: vi.fn().mockRejectedValue(
        new Error('Handler not registered') // Default: feature not implemented
      ),
    };
  }

  /**
   * Register a mock handler response
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerHandler(channel: string, response: any): void {
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    (this.ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockImplementation(async (arg: string, ...args: unknown[]) => {
      if (arg === channel) {
        return response;
      }
      throw new Error(`Handler not registered: ${channel}`);
    });
  }

  /**
   * Force specific error response
   */
  forceError(error: Error): void {
    (this.ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(error);
  }
}

// Export singleton instance for Jest mock
export const mockedElectron = new MockElectronAPI();

// Mock implementation for jest.mock() usage
export function createMockElectronModule(): typeof import('electron') {
  return {
    contextBridge: {
      exposeInMainWorld: vi.fn(),
      exposeInIsolatedWorld: vi.fn(),
    },
    ipcRenderer: mockedElectron.ipcRenderer,
  } as unknown as typeof import('electron');
}
