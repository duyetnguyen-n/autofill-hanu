import { expect, it, vi } from 'vitest';

const fake=vi.hoisted(()=>({name:'postgres',hasTables:false,queries:[] as string[],closed:0}));
vi.mock('pg',()=>({Pool:class{
  async query(sql:string){fake.queries.push(sql);return sql.includes('current_database')?{rows:[{name:fake.name}],rowCount:1}:{rows:fake.hasTables?[{}]:[],rowCount:fake.hasTables?1:0};}
  async end(){fake.closed++;}
}}));
import { loadFixture } from '../../scripts/cloud-load-fixture';

it('refuses a production database name before making any changes',async()=>{
  fake.name='postgres';fake.queries=[];fake.closed=0;
  await expect(loadFixture('postgresql://synthetic:synthetic@127.0.0.1/postgres')).rejects.toThrow('hanu_load_test');
  expect(fake.queries).toHaveLength(1);expect(fake.queries.every(q=>q.startsWith('SELECT'))).toBe(true);expect(fake.closed).toBe(1);
});
it('refuses an existing test database without deleting or changing its data',async()=>{
  fake.name='hanu_load_test';fake.hasTables=true;fake.queries=[];fake.closed=0;
  await expect(loadFixture('postgresql://synthetic:synthetic@127.0.0.1/hanu_load_test')).rejects.toThrow('not empty');
  expect(fake.queries).toHaveLength(2);expect(fake.queries.every(q=>q.startsWith('SELECT'))).toBe(true);expect(fake.closed).toBe(1);
});
