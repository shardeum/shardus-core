# Lost Archiver Detection Testing:

1. Test for working archiver lost detection
   
   Trigger Archivers to kill themselves to test out if lost archiver detection is working
   
   * need new 'kill-archiver' testing route on Archiver

2. Test for investigator finding archiver is up

3. 

4. Trigger a false 'investigate tx' from a node to test investigator not continuing if archiver is up

5. Test for working refutation
   
   Trigger a false 'investigate tx' from a node and a false 'archiver down tx' from the investigator to
   test if refutation is working

4. Edge case tests
   
   a. Test for working archiver lost detection when:
   
   1. archiver is lost but investigator node is down
   2. archiver is lost but investigator ignores 'investigate tx'
   3. archiver is lost and investigator receives multiple 'investigate tx's for the same archiver
   4. archiver is lost and investigator sends nodes multiple 'archiver down tx's in the same cycle for the same archiver
   
   b. Test for archiver lost not going through when:
   
   1. starting node happens to be the investigator node
