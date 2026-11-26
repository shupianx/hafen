import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { color, Glass } from './Glass';

const gridPadding = 5;
const cellPadding = 3;
const tilePadding = 6;
const iconSize = 18;
const labelGap = 4;

const sites = [
  {
    name: 'Google',
    url: 'https://www.google.com/generate_204',
    icon: require('./assets/google.png'),
  },
  {
    name: 'GitHub',
    url: 'https://github.com/',
    icon: require('./assets/github.png'),
  },
  {
    name: 'YouTube',
    url: 'https://www.youtube.com/generate_204',
    icon: require('./assets/youtube.png'),
  },
  {
    name: 'X',
    url: 'https://x.com/robots.txt',
    icon: require('./assets/x.png'),
  },
  {
    name: 'Claude',
    url: 'https://claude.ai/robots.txt',
    icon: require('./assets/claude.png'),
  },
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/robots.txt',
    icon: require('./assets/chatgpt.png'),
  },
];
type Reading = number | '测速中' | '超时' | '未连通' | '待测速';

export function WebsiteLatency({
  route,
  pending,
}: {
  route: string;
  pending: boolean;
}) {
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const { fontScale } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  // Reserve space for the longest site name, its icon and the tile insets.
  const cellWidthNeeded =
    2 * (cellPadding + tilePadding) +
    iconSize +
    labelGap +
    68 * Math.max(1, fontScale);
  const columns = gridWidth
    ? Math.min(
        3,
        Math.max(
          1,
          Math.floor((gridWidth - 2 * gridPadding) / cellWidthNeeded),
        ),
      )
    : 3;
  const requests = useRef(new Map<string, XMLHttpRequest>()).current;

  const measure = useCallback(
    (site: (typeof sites)[number]) => {
      const { name, url } = site;
      const request = new XMLHttpRequest();
      const previous = requests.get(name);
      requests.set(name, request);
      previous?.abort();
      setReadings(values => ({ ...values, [name]: '测速中' }));
      const started = Date.now();
      const finish = (result: Reading) => {
        if (requests.get(name) !== request) return;
        requests.delete(name);
        setReadings(values => ({ ...values, [name]: result }));
      };
      request.open('HEAD', url + '?hafen_t=' + Date.now());
      request.timeout = 6500;
      request.onload = () =>
        finish(
          request.status >= 200 && request.status < 400
            ? Math.max(1, Math.round(Date.now() - started))
            : '未连通',
        );
      request.ontimeout = () => finish('超时');
      request.onerror = () => finish('未连通');
      request.send();
    },
    [requests],
  );

  useEffect(() => {
    setReadings({});
    if (!pending) sites.forEach(measure);
    return () => {
      const active = [...requests.values()];
      requests.clear();
      active.forEach(request => request.abort());
    };
  }, [route, pending, measure, requests]);

  return (
    <View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          网站测速
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="全部重新测速"
          disabled={pending}
          style={styles.action}
          onPress={() => sites.forEach(measure)}
        >
          <Text style={styles.link}>重新测速</Text>
        </Pressable>
      </View>
      <Glass>
        <View
          style={styles.grid}
          onLayout={event => setGridWidth(event.nativeEvent.layout.width)}
        >
          {sites.map(site => {
            const reading = readings[site.name] ?? '待测速';
            const label =
              typeof reading === 'number' ? reading + ' ms' : reading;
            return (
              <View
                key={site.name}
                style={[styles.cell, { width: `${100 / columns}%` }]}
              >
                <Pressable
                  accessibilityRole="button"
                  disabled={pending}
                  accessibilityLabel={
                    site.name + '，' + label + '，点击重新测速'
                  }
                  style={({ pressed }) => [
                    styles.tile,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => measure(site)}
                >
                  <View style={styles.tileRow}>
                    <Image
                      accessible={false}
                      source={site.icon}
                      resizeMode="contain"
                      style={styles.icon}
                    />
                    <Text style={styles.site}>{site.name}</Text>
                  </View>
                  <View style={styles.tileRow}>
                    <View style={styles.statusSlot}>
                      <View
                        style={[
                          styles.dot,
                          typeof reading === 'number'
                            ? styles.measured
                            : styles.waiting,
                        ]}
                      />
                    </View>
                    <Text style={styles.value}>{label}</Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 19, fontWeight: '700', color: color.ink },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  link: { color: color.accent, fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: gridPadding },
  cell: { padding: cellPadding },
  tile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#F5F5F5',
    borderRadius: 17,
    minHeight: 68,
    paddingHorizontal: tilePadding,
    paddingVertical: 10,
    justifyContent: 'center',
    gap: 7,
  },
  pressed: { backgroundColor: '#E7E7E7' },
  tileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: labelGap,
    minHeight: iconSize,
  },
  icon: { width: iconSize, height: iconSize },
  site: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: color.ink },
  statusSlot: { width: iconSize, alignItems: 'center' },
  value: {
    flexShrink: 1,
    fontSize: 12,
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  measured: { backgroundColor: color.success },
  waiting: { backgroundColor: '#919191' },
});
