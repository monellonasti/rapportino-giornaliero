// Errore previsto con messaggio sicuro da mostrare all'operatore
// (409: conflitto con lo stato dei dati; 422: dati da correggere).
export class UserError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 422 = 409,
  ) {
    super(message);
  }
}
