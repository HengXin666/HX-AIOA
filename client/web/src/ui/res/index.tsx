import { useRoute } from "../../app/router";
import Resources from "../resources/Resources";
import type { AreaProps } from "../Shell";

// 资源栏: #/res/<分栏>/<id>
export default function ResArea({ layout }: AreaProps) {
  const route = useRoute();
  return route.name === "res" ? <Resources route={route} layout={layout} /> : null;
}
