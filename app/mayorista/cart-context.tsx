"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "pottery-mayorista-cart";

type CartState = Record<string, number>; // variantId -> quantity

type CartContextValue = {
  cart: CartState;
  setQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clear: () => void;
  totalItemCount: number;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Reading localStorage can only happen after mount (no `window` during
    // SSR), so this can't be a lazy useState initializer — an effect is the
    // only place this one-time read can run.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setCart(JSON.parse(raw));
    } catch {
      // Private browsing or blocked storage — start with an empty cart.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore — cart still works for this page view, just won't persist.
    }
  }, [cart, hydrated]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      setQuantity: (variantId, quantity) =>
        setCart((prev) => {
          if (quantity <= 0) {
            return Object.fromEntries(Object.entries(prev).filter(([id]) => id !== variantId));
          }
          return { ...prev, [variantId]: quantity };
        }),
      removeItem: (variantId) =>
        setCart((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => id !== variantId))
        ),
      clear: () => setCart({}),
      totalItemCount: Object.values(cart).reduce((sum, q) => sum + q, 0),
    }),
    [cart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
