import type { LucideIcon } from "lucide-react";
import {
  Home,
  ShoppingCart,
  Users,
  Store,
  Package,
  Tag,
  Boxes,
  Factory,
  GraduationCap,
  PartyPopper,
  Wallet,
  Receipt,
  BarChart3,
  Settings,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roadmap phase that ships this section — see docs/roadmap.md. */
  phase: number;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/** Currently implemented — safe to link to. */
export const CURRENT_PHASE = 8;

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "",
    items: [{ label: "Inicio", href: "/dashboard", icon: Home, phase: 1 }],
  },
  {
    label: "Comercial",
    items: [
      { label: "Pedidos", href: "/pedidos", icon: ShoppingCart, phase: 3 },
      { label: "Clientes", href: "/clientes", icon: Users, phase: 2 },
      { label: "Mayoristas", href: "/mayoristas", icon: Store, phase: 5 },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Productos", href: "/productos", icon: Package, phase: 2 },
      { label: "Precios", href: "/precios", icon: Tag, phase: 2 },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { label: "Stock", href: "/stock", icon: Boxes, phase: 4 },
      { label: "Producción", href: "/produccion", icon: Factory, phase: 6 },
    ],
  },
  {
    label: "Experiencias",
    items: [
      { label: "Talleres", href: "/talleres", icon: GraduationCap, phase: 7 },
      { label: "Eventos", href: "/eventos", icon: PartyPopper, phase: 8 },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { label: "Pagos", href: "/pagos", icon: Wallet, phase: 3 },
      { label: "Gastos", href: "/gastos", icon: Receipt, phase: 9 },
      { label: "Reportes", href: "/reportes", icon: BarChart3, phase: 9 },
    ],
  },
  {
    label: "Administración",
    items: [
      { label: "Configuración", href: "/configuracion", icon: Settings, phase: 1 },
    ],
  },
];
