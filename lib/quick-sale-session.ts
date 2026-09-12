// Estado mínimo y puro de "sesión de venta rápida" — separado del estado
// que devuelve useActionState(createQuickSale, {}) a propósito.
//
// Bug real (2026-09-11): la pantalla de éxito se mostraba con
// `if (state.result) { ... }`, donde `state` es lo que devuelve
// useActionState. Tocar "Nueva venta" sólo reseteaba estado LOCAL del
// formulario (carrito, cliente, etc.) — nunca `state.result`, que sólo
// cambia cuando la action vuelve a correr. Como la action no corre de
// nuevo hasta el próximo submit, `state.result` seguía siendo el de la
// venta anterior y la pantalla de éxito nunca se iba: "Nueva venta" no
// hacía nada visible.
//
// La solución es no usar `state.result` como fuente de verdad de "hay que
// mostrar la pantalla de éxito" — en su lugar, un resultado exitoso se
// copia a este estado de sesión (efecto en el componente), y "Nueva
// venta" lo limpia explícitamente además de asignar un client_request_id
// nuevo, dejando la sesión completamente lista para una segunda venta
// independiente.

export type QuickSaleSuccess = { orderId: string; humanCode: string; total: number };

export type QuickSaleSessionState = {
  clientRequestId: string;
  success: QuickSaleSuccess | null;
};

export type QuickSaleSessionAction =
  | { type: "sale_succeeded"; result: QuickSaleSuccess }
  | { type: "start_new_sale"; nextClientRequestId: string };

export function quickSaleSessionReducer(
  state: QuickSaleSessionState,
  action: QuickSaleSessionAction
): QuickSaleSessionState {
  switch (action.type) {
    case "sale_succeeded":
      return { ...state, success: action.result };
    case "start_new_sale":
      return { clientRequestId: action.nextClientRequestId, success: null };
    default:
      return state;
  }
}
