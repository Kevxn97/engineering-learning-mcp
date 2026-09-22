SET ROLE elm_owner;
CREATE OR REPLACE FUNCTION elm.apply_retirements(o uuid,items jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
DECLARE item jsonb; target uuid; action text; affected uuid[]; member uuid; total integer:=0;
BEGIN
 UPDATE elm.service_state SET serving=false WHERE organization_id=o;
 IF jsonb_array_length(items)>100000 THEN RAISE EXCEPTION 'manifest too large'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(items) LOOP
  target:=(item->>'learning_id')::uuid;action:=item->>'action';
  IF action NOT IN('suspended','revoked','archived','purged') THEN RAISE EXCEPTION 'invalid retirement'; END IF;
  affected:=ARRAY[target];
  IF action='purged' THEN
   WITH RECURSIVE deps AS (SELECT target AS id UNION SELECT l.learning_id FROM elm.lineage l JOIN deps d ON l.source_learning_id=d.id WHERE l.organization_id=o)
   SELECT array_agg(id) INTO affected FROM deps;
  END IF;
  FOREACH member IN ARRAY affected LOOP
   INSERT INTO elm.retirement_events(id,organization_id,learning_id,action) VALUES(gen_random_uuid(),o,member,action);
  END LOOP;
  UPDATE elm.learnings SET state=CASE WHEN action='purged' THEN 'revoked' ELSE action END,updated_at=now() WHERE organization_id=o AND id=ANY(affected);
  IF action='purged' THEN
   DELETE FROM elm.proposals WHERE organization_id=o AND (derived_from=ANY(affected) OR amends_learning_id=ANY(affected) OR id IN(SELECT proposal_id FROM elm.review_decisions WHERE learning_id=ANY(affected)));
   DELETE FROM elm.learnings WHERE organization_id=o AND id=ANY(affected);
   DELETE FROM elm.delivery_receipts WHERE organization_id=o AND learning_id=ANY(affected);
   DELETE FROM elm.idempotency_records WHERE organization_id=o;
  END IF;
  total:=total+cardinality(affected);
 END LOOP;
 RETURN total;
END $$;
RESET ROLE;
