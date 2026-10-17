// Token di un connettore (app Claude collegata con OAuth, 18.10.2026): ha "client_id".
// Vale solo per leggere (funzione mcp); le funzioni che mandano o cambiano lo rifiutano, come chiedi-ai e capo-veloce.
// Si chiama dopo /auth/v1/user, che ha già controllato la firma dello stesso token.
export function daConnettore(jwt: string) {
  try {
    const parte = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return !!JSON.parse(atob(parte + '='.repeat((4 - (parte.length % 4)) % 4))).client_id
  } catch {
    return true
  }
}
