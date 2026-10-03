// Transport mode labels, icons and colours (Agent A).
import { Bus, TrainFront, TramFront } from '@lucide/vue'
import type { TransportMode } from '~/types/api'

export const TRANSPORT_MODE: Record<TransportMode, { label: string; icon: typeof Bus; text: string; bg: string }> = {
  luas: { label: 'Luas', icon: TramFront, text: 'text-transport-luas', bg: 'bg-transport-luas' },
  dart: { label: 'DART', icon: TrainFront, text: 'text-transport-dart', bg: 'bg-transport-dart' },
  rail: { label: 'Rail', icon: TrainFront, text: 'text-transport-rail', bg: 'bg-transport-rail' },
  bus: { label: 'Bus', icon: Bus, text: 'text-transport-bus', bg: 'bg-transport-bus' },
}
