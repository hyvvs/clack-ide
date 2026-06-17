; "Open in Clack" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInClack" "" "Open in Clack"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInClack" "Icon" '"$INSTDIR\clack.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInClack" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInClack\command" "" '"$INSTDIR\clack.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInClack" "" "Open in Clack"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInClack" "Icon" '"$INSTDIR\clack.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInClack" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInClack\command" "" '"$INSTDIR\clack.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInClack" "" "Open in Clack"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInClack" "Icon" '"$INSTDIR\clack.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInClack" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInClack\command" "" '"$INSTDIR\clack.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInClack"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInClack"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInClack"
!macroend
