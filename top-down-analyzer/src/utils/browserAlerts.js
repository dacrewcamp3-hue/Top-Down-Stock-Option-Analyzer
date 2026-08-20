// Browser notification helpers via the Web Notifications API.
// Permission is requested lazily the first time the user enables alerts.

export function canNotify() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && Notification.permission === 'granted'
}

export async function requestNotifPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

// Fire a browser notification and auto-close it after 10 seconds.
// tag de-duplicates — re-fires the same tag instead of stacking.
export function fireNotification(title, body, tag = 'tdsa') {
  if (!canNotify()) return
  try {
    const n = new Notification(title, { body, tag, renotify: true })
    setTimeout(() => n.close(), 10_000)
  } catch (e) {
    console.warn('[notify]', e.message)
  }
}
