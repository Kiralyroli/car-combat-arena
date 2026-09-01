@echo off
REM ===================================================================
REM  Car Combat Arena -- fejlesztoi inditas duplakattintasra.
REM
REM  Elinditja a ket szervert (jatekszerver 8080, kliens 5173), es
REM  megnyitja a jatekot a bongeszoben.
REM
REM  Ez a fajl csak egy burok: az igazi munka a tools/dev.mjs-ben van,
REM  hogy ugyanaz a logika fusson duplakattintasra es `npm run dev:all`
REM  parancsra is.
REM ===================================================================

REM A script sajat konyvtarabol dolgozunk -- duplakattintasnal a
REM munkakonyvtar barmi lehet.
cd /d "%~dp0"

REM --force: ha egy korabbi inditas bent ragadt, eloszor leall.
REM Duplakattintasnal ez a helyes alapertelmezes -- a felhasznalonak
REM nincs hova beirnia a kapcsolot, es a "mar fut valami" hibauzenet
REM egy bezarodo ablakban ugysem lenne olvashato.
node tools\dev.mjs --force

REM Az ablak maradjon nyitva, ha barmi hiba miatt kilep -- kulonben az
REM uzenet egy pillanat alatt eltunne.
echo.
echo A szerverek lealltak. Nyomj egy billentyut a bezarashoz.
pause > nul
