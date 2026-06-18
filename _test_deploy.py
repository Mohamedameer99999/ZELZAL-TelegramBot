import requests
import os

username = "zelzalsecurity"
domain = "zelzalsecurity.pythonanywhere.com"
token = "1761ba2d38ccb8ea1515ef6a14162c879aa4f4a8"

headers = {'Authorization': f'Token {token}'}
url = f'https://www.pythonanywhere.com/api/v0/user/{username}/webapps/{domain}/reload/'
response = requests.post(url, headers=headers)
print(f'Status: {response.status_code}')
print(f'Response: {response.text}')
