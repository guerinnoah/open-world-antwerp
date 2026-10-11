import proj4 from 'proj4';

// Belgian Lambert 72 (EPSG:31370) with the 7-parameter datum shift to WGS84: good to ~1 m.
proj4.defs(
  'EPSG:31370',
  '+proj=lcc +lat_0=90 +lon_0=4.36748666666667 +lat_1=51.1666672333333 +lat_2=49.8333339 ' +
    '+x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs',
);

const toWgs84 = proj4('EPSG:31370', 'WGS84');

export function lambert72ToLatLon(x: number, y: number): [number, number] {
  const [lon, lat] = toWgs84.forward([x, y]);
  return [lat, lon];
}

export function latLonToLambert72(lat: number, lon: number): [number, number] {
  const [x, y] = toWgs84.inverse([lon, lat]);
  return [x, y];
}
