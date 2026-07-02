export function getDeviceId(): string {
  let id = localStorage.getItem('attendance_device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('attendance_device_id', id)
  }
  return id
}
