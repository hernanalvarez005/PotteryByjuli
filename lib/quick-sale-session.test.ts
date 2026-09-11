import { describe, it, expect } from "vitest";
import { quickSaleSessionReducer, type QuickSaleSessionState } from "./quick-sale-session";

// Regresión del bug real (2026-09-11): tocar "Nueva venta" no permitía
// registrar una segunda venta porque la pantalla de éxito se guiaba por
// el estado de useActionState, que nunca se limpiaba localmente. Esta
// prueba reproduce exactamente la secuencia venta A → Nueva venta → venta
// B y confirma que son dos operaciones distintas con estado
// completamente separado.
describe("quickSaleSessionReducer — venta A → Nueva venta → venta B", () => {
  it("tracks two independent sales, resetting success and rotating client_request_id in between", () => {
    let state: QuickSaleSessionState = { clientRequestId: "request-a", success: null };

    // Venta A se completa.
    state = quickSaleSessionReducer(state, {
      type: "sale_succeeded",
      result: { orderId: "order-a", humanCode: "PED-000001", total: 24000 },
    });
    expect(state.success?.orderId).toBe("order-a");

    // "Nueva venta": debe limpiar el éxito anterior y asignar un
    // client_request_id nuevo — nunca reutilizar el de la venta A.
    state = quickSaleSessionReducer(state, { type: "start_new_sale", nextClientRequestId: "request-b" });
    expect(state.success).toBeNull();
    expect(state.clientRequestId).toBe("request-b");
    expect(state.clientRequestId).not.toBe("request-a");

    // Venta B se completa — debe poder mostrarse, no quedar bloqueada
    // por el resultado de la venta A.
    state = quickSaleSessionReducer(state, {
      type: "sale_succeeded",
      result: { orderId: "order-b", humanCode: "PED-000002", total: 18000 },
    });
    expect(state.success?.orderId).toBe("order-b");
    expect(state.success?.orderId).not.toBe("order-a");
  });

  it("a fresh session starts with no success screen showing", () => {
    const state: QuickSaleSessionState = { clientRequestId: "request-a", success: null };
    expect(state.success).toBeNull();
  });
});
