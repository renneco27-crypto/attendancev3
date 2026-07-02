export async function checkMockLocation(): Promise<{ isMocked: boolean; platform?: string }> {
  if (typeof window !== 'undefined' && (window as any).nativeBridge?.checkMockLocation) {
    return new Promise((resolve) => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail.type === 'MOCK_LOCATION_RESULT') {
          window.removeEventListener('nativeBridgeMessage', handler)
          resolve({ isMocked: detail.isMocked, platform: detail.platform })
        }
      }
      window.addEventListener('nativeBridgeMessage', handler)
      ;(window as any).nativeBridge.checkMockLocation()
      setTimeout(() => { window.removeEventListener('nativeBridgeMessage', handler); resolve({ isMocked: false }) }, 5000)
    })
  }
  return { isMocked: false }
}
