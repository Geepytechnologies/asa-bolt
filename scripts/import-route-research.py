"""Extract the supplied research workbook without changing it (Python standard library only)."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import json
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'outputs/abia_google_maps_distance_matrix/abia_google_maps_distance_matrix.xlsx'
TARGET = ROOT / 'server/data/abia-research.json'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def extract():
    with zipfile.ZipFile(SOURCE) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        def sheet(number):
            rows = []
            for row in ET.fromstring(archive.read(f'xl/worksheets/sheet{number}.xml')).findall('.//s:sheetData/s:row', NS):
                values = {}
                for cell in row.findall('s:c', NS):
                    value = cell.find('s:v', NS)
                    kind = cell.get('t')
                    text = value.text if value is not None else ''
                    if kind == 's': text = strings[int(text)]
                    elif kind == 'inlineStr': text = ''.join(cell.find('s:is', NS).itertext())
                    values[''.join(c for c in cell.get('r') if c.isalpha())] = text
                rows.append((int(row.get('r')), values))
            return rows
        locations = []
        for row, values in sheet(2):
            if row < 3: continue
            locations.append({'researchId': values['A'], 'category': values['B'], 'area': values['C'],
                'name': values['D'], 'mapsQuery': values['E'], 'sourceUrl': values['F'], 'sourceRow': row})
        names = {item['name']: item['researchId'] for item in locations}
        routes = []
        for row, values in sheet(3):
            if row < 2: continue
            distance = Decimal(values['C'])
            if not distance.is_finite() or distance <= 0: raise ValueError(f'Unusable distance at Routes!C{row}')
            collected = datetime(1899, 12, 30, tzinfo=timezone.utc) + timedelta(microseconds=int(Decimal(values['I']) * 86400000000))
            routes.append({'originResearchId': names[values['A']], 'destinationResearchId': names[values['B']],
                'distanceKm': format(distance, 'f'), 'pairKey': values['F'], 'sourceUrl': values['G'],
                'sourceLabel': values['H'], 'collectedAt': collected.isoformat(), 'sourceRow': row})
        pairs = {tuple(sorted((r['originResearchId'], r['destinationResearchId']))) for r in routes}
        if len(locations) != 27 or len(names) != 27 or len({l['researchId'] for l in locations}) != 27:
            raise ValueError('Expected 27 distinct reference locations')
        if len(routes) != 351 or len(pairs) != 351 or any(a == b for a, b in pairs):
            raise ValueError('Expected all 351 distinct route pairs')
        if any(not r['sourceUrl'].startswith('https://www.google.com/maps/') for r in routes):
            raise ValueError('Missing route source URL')
        sources = [{'label': v.get('A', ''), 'value': v.get('B', ''), 'use': v.get('C', '')} for n, v in sheet(5) if n > 1]
        calculator = dict(sheet(1))
        return {'id': 'abia-google-maps-2026-09-14', 'workbook': str(SOURCE.relative_to(ROOT)),
            'sha256': sha256(SOURCE.read_bytes()).hexdigest(), 'collectionDate': '2026-09-14',
            'reference': {'baseFareNaira': calculator[4]['B'], 'baseDistanceKm': calculator[5]['B'],
                'suggestedRatePerKm': calculator[6]['B'], 'approved': False},
            'locations': locations, 'routes': routes, 'sources': sources,
            'lgaMap': [{'lga': v.get('A', ''), 'referenceLocation': v.get('B', ''), 'query': v.get('C', ''),
                'referenceType': v.get('D', ''), 'note': v.get('E', '')} for n, v in sheet(4) if n > 1]}


if __name__ == '__main__':
    data = extract()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(f"Extracted {len(data['locations'])} locations and {len(data['routes'])} route pairs; source SHA-256 {data['sha256']}")
